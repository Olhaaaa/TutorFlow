#!/usr/bin/env bash
#
# Збірка образу й викладка застосунку в кластер, піднятий Terraform-ом.
# Усе, що відоме лише після terraform apply (реєстр, адреса, ім'я IP),
# береться з `terraform output` — руками нічого не переписується.
#
#   infra/deploy.sh                 зібрати образ із поточного коміту й викласти
#   infra/deploy.sh seed            те саме + демо-дані (TRUNCATE!; у мікросервісах — скид усіх чотирьох баз)
#   infra/deploy.sh status          що зараз у кластері
#
# Опції:
#   --env <key>        середовище з var.environments (типово monolith);
#                      microservices викладається чартом tutorflow-ms
#   --chart <name>     чарт із infra/helm/ замість вибраного за середовищем
#   --tag <tag>        не збирати, а викласти вже запушений тег
#   --cloud-build      збирати в Cloud Build замість локального Docker
#   --split            воркер розкладкою лаби 4 (KEDA + CronJob), див. values.yaml
#   --set k=v, -f f    значення для helm, напр. --set api.autoscaling.maxReplicas=6
#   -- <helm args>     решта йде в helm як є (лише з bash: PowerShell з'їдає `--`)
#
# Запускати з Git Bash (Windows) або будь-якого bash.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT/infra/terraform"

cmd="deploy"
env_key="monolith"
tag=""
chart=""
split=false
cloud_build=false
extra=()

if [[ $# -gt 0 && "$1" != -* ]]; then cmd="$1"; shift; fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) env_key="$2"; shift 2 ;;
    --tag) tag="$2"; shift 2 ;;
    --chart) chart="$2"; shift 2 ;;
    --cloud-build) cloud_build=true; shift ;;
    --split) split=true; shift ;;
    # Значення для helm і без `--`: PowerShell цей роздільник з'їдає сам, і
    # через deploy.ps1 він до скрипта не доходить.
    --set|--set-string|-f|--values) extra+=("$1" "$2"); shift 2 ;;
    --) shift; extra+=("$@"); break ;;
    *) echo "невідома опція: $1" >&2; exit 2 ;;
  esac
done

# Чарт за середовищем: моноліт і мікросервіси — різні набори процесів, тому й
# різні чарти, але кластер, база й скрипт спільні.
if [[ -z "$chart" ]]; then
  case "$env_key" in
    microservices) chart="tutorflow-ms" ;;
    *) chart="tutorflow" ;;
  esac
fi
CHART="$ROOT/infra/helm/$chart"
[[ -d "$CHART" ]] || { echo "немає чарту $CHART" >&2; exit 2; }

if $split; then
  # У мікросервісах воркер нагадувань тримає і споживача, і бота в одному
  # процесі (lab3/worker.ts), тож розкладки ADR-0011 там немає.
  [[ "$chart" == "tutorflow" ]] || { echo "--split є лише в чарті моноліту" >&2; exit 2; }
  extra+=(--set worker.mode=split)
fi

for bin in terraform gcloud kubectl helm; do
  command -v "$bin" >/dev/null || { echo "не знайдено $bin — див. infra/README.md, «Що встановити»" >&2; exit 1; }
done

# --- виходи Terraform ---
# Без jq і без node: на Windows-машині, яка лише розгортає, їх може не бути.
# Рядкові виходи читаються `-raw`; мапа середовищ — однорядковий JSON, де в
# об'єкта середовища всі значення рядкові й вкладених об'єктів немає, тож
# поле витягується sed-ом.
tf() {
  terraform -chdir="$TF_DIR" output -raw "$1"
}

envs_json="$(terraform -chdir="$TF_DIR" output -json environments | tr -d ' \t\r\n')"
env_obj="$(sed -n "s/.*\"$env_key\":{\([^}]*\)}.*/\1/p" <<<"$envs_json")"
[[ -n "$env_obj" ]] || { echo "немає середовища «$env_key» у terraform output environments" >&2; exit 1; }
env_field() {
  local v
  v="$(sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" <<<"$env_obj")"
  [[ -n "$v" ]] || { echo "немає поля $1 у середовищі $env_key" >&2; exit 1; }
  printf '%s' "$v"
}

project="$(tf project_id)"
zone="$(tf zone)"
cluster="$(tf cluster_name)"
registry="$(tf registry)"
namespace="$(env_field namespace)"
host="$(env_field host)"
ip_name="$(env_field static_ip_name)"
url="$(env_field url)"

# kubectl/helm дивляться саме на цей кластер, незалежно від поточного контексту
gcloud container clusters get-credentials "$cluster" --zone "$zone" --project "$project" --quiet >/dev/null
context="gke_${project}_${zone}_${cluster}"

if [[ "$cmd" == "status" ]]; then
  kubectl --context "$context" -n "$namespace" get deploy,sts,cronjob,hpa,scaledobject,ingress,managedcertificate,pods 2>/dev/null \
    || kubectl --context "$context" -n "$namespace" get all
  echo
  echo "адреса: $url"
  exit 0
fi
[[ "$cmd" == "deploy" || "$cmd" == "seed" ]] || { echo "невідома команда: $cmd" >&2; exit 2; }

# --- образ ---
image="$registry/tutorflow"
if [[ -z "$tag" ]]; then
  tag="$(git -C "$ROOT" rev-parse --short HEAD)"
  # Незакомічені зміни — інший код під тим самим тегом. Позначаємо явно.
  if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
    tag="$tag-dirty-$(date +%Y%m%d%H%M%S)"
  fi

  echo "==> збірка $image:$tag"
  if $cloud_build; then
    # Контекст відправляється з урахуванням .gcloudignore (а без нього — .gitignore).
    gcloud builds submit "$ROOT" --project "$project" --tag "$image:$tag"
  else
    gcloud auth configure-docker "${registry%%/*}" --quiet >/dev/null
    # linux/amd64 явно: вузли GKE — x86, а образ, зібраний на Apple Silicon, був би arm64.
    docker build --platform linux/amd64 -t "$image:$tag" "$ROOT"
    docker push "$image:$tag"
  fi
fi

# --- викладка ---
seed_args=()
[[ "$cmd" == "seed" ]] && seed_args=(--set seed.run=true)

echo "==> helm upgrade $namespace ($chart, $tag)"
helm upgrade --install tutorflow "$CHART" \
  --kube-context "$context" \
  --namespace "$namespace" \
  --set image.repository="$image" \
  --set image.tag="$tag" \
  --set ingress.host="$host" \
  --set ingress.staticIpName="$ip_name" \
  "${seed_args[@]}" \
  "${extra[@]}" \
  --wait --timeout 10m

echo
echo "готово: $url"
echo "сертифікат: kubectl --context $context -n $namespace get managedcertificate"
