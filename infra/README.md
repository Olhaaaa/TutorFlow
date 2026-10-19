# Розгортання в Google Cloud

Terraform піднімає платформу, Helm викладає на неї застосунок. Чому саме так —
[ADR-0021](../docs/adr/0021-gcp-deployment.md).

```
infra/
  terraform/        VPC, GKE, Cloud SQL, Artifact Registry, IP, KEDA, секрети
  helm/tutorflow/   API + HPA, воркер (single | split), Redis, міграції, Ingress
  deploy.sh         зібрати образ → запушити → helm upgrade
```

```
                  https://<ip>.sslip.io
                          │
              Global HTTP(S) LB + сертифікат Google
                          │
   ┌──────────── GKE (zonal, spot-вузли, autoscaler) ─────────────┐
   │ namespace tutorflow                                          │
   │   api ×1…4 (HPA) ──┐        worker (усі ролі)                │
   │                    ├── redis (StatefulSet, PVC) ──┘          │
   │   migrate (хук)    │                                         │
   │ namespace keda                                               │
   └────────────────────┼─────────────────────────────────────────┘
                        │ приватна IP, через VPC
                Cloud SQL PostgreSQL 17
```

## Що встановити

На Windows (PowerShell):

```powershell
winget install Google.CloudSDK Hashicorp.Terraform Helm.Helm
```

Потім у новому терміналі:

```bash
gcloud components install gke-gcloud-auth-plugin kubectl
```

Docker Desktop потрібен для локальної збірки образу; без нього —
`infra/deploy.sh --cloud-build`.

`deploy.sh` — bash-скрипт. З **Git Bash** він запускається як є; з
**PowerShell** — через обгортку з тими самими аргументами:

```powershell
.\infra\deploy.ps1 seed
```

(`bash infra/deploy.sh` у PowerShell не працює: там `bash` — це WSL.)

## Перший раз

**0. Проєкт.** На [console.cloud.google.com](https://console.cloud.google.com)
активувати пробний період (300 $ на 90 днів), створити проєкт і запам'ятати
його **ID**. Одразу варто поставити бюджет зі сповіщенням: Billing → Budgets &
alerts → 50 $.

**1. Вхід.** Terraform ходить у Google від імені Application Default
Credentials, gcloud — від свого власного входу; потрібні обидва.

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project <project-id>
```

**2. Платформа** — ~15 хвилин, найдовше створюються кластер і база.

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # вписати project_id
terraform init
terraform apply
```

Якщо apply упав на кроці з `kubernetes_*` або `helm_release` одразу після
створення кластера — повторити `terraform apply`: кластер міг ще не прийняти
перші з'єднання.

**3. Застосунок** — з кореня репозиторію:

```bash
infra/deploy.sh seed     # перший раз: збірка, міграції й демо-дані
infra/deploy.sh          # далі: збірка поточного коміту й оновлення
infra/deploy.sh status   # що зараз запущено
```

Наприкінці скрипт друкує адресу. По http вона відповідає, щойно балансувальник
підніметься (5–10 хв); https — коли Google випустить сертифікат (15–60 хв):

```bash
kubectl -n tutorflow get managedcertificate    # Status: Active
```

**Лише після цього** — редирект на https: `ingress.httpsRedirect: true` у
`infra/helm/tutorflow/values.yaml`, і наступний деплой його ввімкне. Не
раніше: доки сертифікат `Provisioning`, https не відповідає, і редирект
робить недоступним і http — «This site can't be reached». Значення через
`--set` діє лише на один деплой: `deploy.sh` щоразу передає значення заново.

**4. Токен еквайрингу — після сідера**, як і на Render: сідер чистить
`teachers`. Увійти викладачем → «Оплата» → вставити токен. Колбек уже
показується справжній: `https://<ip>.sslip.io/api/payments/monobank/callback`.

## Бот Telegram

Токен — секрет, тож він іде не в чарт і не в git, а в `terraform.tfvars` (його
ігнорує `.gitignore`). Terraform кладе його в Secret `tutorflow-secrets`
поряд з іншими секретами.

1. **Бот.** У Telegram: @BotFather → `/newbot` → ім'я → токен виду
   `123456789:AA…`. Окремий бот на кожне місце, де він запущений: Telegram не
   дає `getUpdates` двом процесам одночасно (409), тож один токен у хмарі й
   у локальному компоузі вибиватимуть один одного.
2. **`infra/terraform/terraform.tfvars`:**

   ```hcl
   telegram_bot_tokens = {
     monolith = "123456789:AA…"
   }
   ```

3. **Застосувати й перезапустити поди.** Kubernetes не перезапускає под, коли
   змінився Secret, — без перезапуску процеси далі живуть зі старим (порожнім)
   токеном. Токен потрібен і воркеру (бот, нагадування), і API (посилання на
   бота через `getMe`).

   ```bash
   terraform -chdir=infra/terraform apply
   kubectl -n tutorflow rollout restart deployment
   ```

4. **Перевірка.** `kubectl -n tutorflow logs deploy/tutorflow-worker` — немає
   рядка «бот вимкнений: не задано TELEGRAM_BOT_TOKEN»; у застосунку на картці Telegram з'являється
   посилання на бота з кодом прив'язки.

Прибрати токен — видалити рядок із `telegram_bot_tokens`, `apply`, перезапуск.

## Що відрізняється від Render і Compose

| | Render (лаба 1) | Compose (лаба 2) | GKE |
|---|---|---|---|
| База | Neon | контейнер postgres | Cloud SQL, приватна IP |
| Redis / шина | немає | контейнер | StatefulSet із PVC |
| Переходи станів | таймер в API | воркер | воркер або CronJob (`--split`) |
| Міграції | руками з ноутбука | одноразовий контейнер | Job-хук перед кожним релізом |
| Секрети | generateValue | `.env` | генерує Terraform, лежать у Secret |
| `PUBLIC_BASE_URL` | `RENDER_EXTERNAL_URL` | localhost | статична IP → sslip.io, ConfigMap від Terraform |
| Масштабування | немає | немає | HPA для API, KEDA для воркера, autoscaler вузлів |

## Лаба 4: що тут уже є

- **Відтворюване розгортання.** Уся інфраструктура — `terraform apply`, реліз
  — `infra/deploy.sh`; `terraform plan` показує розбіжність між кодом і хмарою.
- **Автомасштабування на трьох рівнях.**
  HPA за CPU для API (`kubectl -n tutorflow get hpa -w`);
  KEDA за довжиною стріму `tutorflow.events` для воркера подій;
  cluster autoscaler додає вузол, коли подам нема куди сісти.
  Розкладка воркера з ADR-0011 вмикається так:

  ```bash
  infra/deploy.sh --split
  kubectl -n tutorflow get scaledobject,hpa,cronjob
  ```

- **Моніторинг.** Логи всіх подів — Cloud Logging (Logs Explorer, фільтр
  `resource.labels.namespace_name="tutorflow"`); метрики — Cloud Monitoring →
  Dashboards → GKE; повільні запити до бази — Cloud SQL → Query Insights.

## Мікросервіси (лаба 3)

Той самий кластер і той самий інстанс Cloud SQL — порівняння архітектур на
тому самому залізі. Окремо в мікросервісів лише те, що мусить бути окремим:
namespace `tutorflow-ms`, бази, Redis (стрім той самий за ім'ям, тож спільний
змішав би події), бот Telegram, адреса й сертифікат.

```
 tutor-flow-cloud.duckdns.org            <ip>.sslip.io / свій домен
          │                                        │
     LB + сертифікат                          LB + сертифікат
          │                                        │
 ┌──────────────────────── той самий кластер GKE ─────────────────────────┐
 │ ns tutorflow (лаба 2)            │ ns tutorflow-ms (лаба 3)            │
 │   api · worker · redis           │   gateway ◄── єдиний бекенд Ingress │
 │                                  │     ├─► identity                    │
 │                                  │     ├─► scheduling ─┐ /internal     │
 │                                  │     ├─► billing ◄───┘ + outbox      │
 │                                  │     └─► notifications               │
 │                                  │   scheduling-worker · billing-worker │
 │                                  │   notifications-worker (бот, стрім)  │
 │                                  │   redis · migrate-{4} · reset        │
 └──────────────┬───────────────────┴──────────────┬─────────────────────┘
                │       один інстанс Cloud SQL      │
           db tutorflow        db identity · scheduling · billing · notifications
```

Що з compose лаби 3 стало чим:

| Compose (`lab3-microservices/compose.yml`) | GKE (`infra/helm/tutorflow-ms`) |
|---|---|
| 4 контейнери `postgres-*` | 4 бази в спільному Cloud SQL, кожному сервісу — свій `DATABASE_URL` із `DATABASE_URL_<СЕРВІС>` секрету |
| `identity`, `scheduling`, `billing`, `notifications`, `gateway` | Deployment + Service (порт 8080, ті самі імена) + HPA кожному |
| опублікований порт лише в `gateway` | Ingress лише на `gateway`; решта — ClusterIP |
| `INTERNAL_TOKEN` у `.env` | генерує Terraform, лежить у секреті |
| `*-worker` | Deployment по одній репліці, `Recreate` (бот у `notifications-worker`) |
| `migrate-*` | Job-хуки `pre-upgrade`, по одному на базу |
| `reset` під профілем `seed` | Job-хук, лише з `deploy.sh seed --env microservices` |

**Підняти.** У `infra/terraform/terraform.tfvars`:

```hcl
environments = {
  monolith = { ... }
  microservices = {
    namespace = "tutorflow-ms"
    databases = ["identity", "scheduling", "billing", "notifications"]
    # domain  = "tutor-flow-ms.duckdns.org"
  }
}
# свій бот, не той самий, що в моноліту
telegram_bot_tokens = { monolith = "…", microservices = "…" }
```

```bash
terraform -chdir=infra/terraform apply      # namespace, бази, IP, секрети
infra/deploy.sh seed --env microservices    # з гілки lab3: образ, міграції, демо-дані
infra/deploy.sh status --env microservices
```

`apply`, що вперше вмикає мікросервіси, ще й переводить Cloud SQL на
`db-g1-small` з `max_connections=200`: моноліт і мікросервіси разом тримають
до ~120 з'єднань, на f1-micro їх не вмістити. Зміна тарифу перезапускає
інстанс — кілька хвилин моноліт без бази.

**Свій домен.** Після першого `apply` — `terraform output environments` дає
`static_ip` мікросервісів. Завести в DuckDNS другий піддомен на цю IP,
розкоментувати `domain`, `apply` і ще раз `deploy.sh --env microservices`.

**Код Terraform мусить збігатись на обох гілках.** Стан один на весь кластер;
`apply` із гілки, де інший код, перебудує ресурси під той код. Набір середовищ
приходить із локального `terraform.tfvars`, а не з гілки, тож доки `.tf`
однакові, `apply` безпечний з будь-якої.

**Замір лаби 3 у хмарі.** Ті самі сценарії `lab3-k6/` проти двох адрес, по
черзі, а не одночасно: обидві версії ділять вузли, і паралельний прогін
міряв би конкуренцію за CPU, а не архітектуру.

**Прибрати лише мікросервіси**, лишивши моноліт: `helm uninstall tutorflow -n
tutorflow-ms`, дочекатись зникнення Ingress, видалити PVC, прибрати ключ
`microservices` з `environments` і `apply`.

## Спільний стан (робота вдвох)

Локальний `terraform.tfstate` містить паролі й ключі — у git він не йде, і
другий учасник його не бачить. Щоб працювати з одного стану:

```bash
gcloud storage buckets create gs://<project-id>-tfstate --location=europe-central2 --uniform-bucket-level-access
gcloud storage buckets update gs://<project-id>-tfstate --versioning
```

Розкоментувати `backend "gcs"` у `versions.tf`, вписати бакет і виконати
`terraform init -migrate-state`. Другому учаснику — роль Editor у проєкті
(IAM & Admin → IAM → Grant access).

## Прибрати все

Спершу — реліз: балансувальник, NEG-и й диск Redis створює не Terraform, а
контролери GKE, і прибирають їх теж вони. Якщо одразу знести кластер, вони
лишаться сиротами й далі коштуватимуть грошей, а статична IP не видалиться,
бо зайнята.

```bash
helm uninstall tutorflow -n tutorflow
kubectl -n tutorflow get ingress    # дочекатись, поки зникне (~5 хв)
kubectl -n tutorflow delete pvc --all
cd infra/terraform && terraform destroy
```

## Скільки коштує

Приблизно, europe-central2, на місяць:

| Ресурс | лише моноліт | моноліт + мікросервіси |
|---|---|---|
| Керування кластером (зональний) | 0 — free tier | 0 — той самий кластер |
| Вузли e2-standard-2 spot | ~15 (1 вузол) | ~30 (autoscaler додасть другий) |
| Cloud SQL db-g1-small + 10 ГБ SSD | ~25 | ~25 — той самий інстанс |
| Балансувальник | ~18 | ~36 — по одному на середовище |
| Cloud NAT, диски, реєстр, логи | ~5 | ~7 |
| **Разом** | **~65** | **~100** |

Пробних 300 $ на 90 днів вистачає на обидві версії, але впритул. Мікросервіси
варто тримати ввімкненими на час замірів і показу, а потім прибирати — див.
«Прибрати лише мікросервіси» вище; повернути — одна команда `deploy.sh`.
Окремий кластер для мікросервісів коштував би ще ~73 $/міс лише за керування:
free tier GKE покриває один зональний кластер на платіжний акаунт.
