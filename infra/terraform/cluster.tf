# Усе, що всередині кластера, але належить платформі, а не застосунку:
# KEDA, namespace-и, секрети й адреси середовищ. Сам застосунок ставить Helm
# (infra/helm/tutorflow) — його оновлюють десятки разів, а це — майже ніколи.

data "google_client_config" "current" {}

locals {
  cluster_host = "https://${google_container_cluster.main.endpoint}"
  cluster_ca   = base64decode(google_container_cluster.main.master_auth[0].cluster_ca_certificate)
}

provider "kubernetes" {
  host                   = local.cluster_host
  token                  = data.google_client_config.current.access_token
  cluster_ca_certificate = local.cluster_ca
}

provider "helm" {
  kubernetes = {
    host                   = local.cluster_host
    token                  = data.google_client_config.current.access_token
    cluster_ca_certificate = local.cluster_ca
  }
}

# --- KEDA: масштабування воркера за довжиною стріму (лаба 4, ADR-0011) ---

resource "helm_release" "keda" {
  name             = "keda"
  repository       = "https://kedacore.github.io/charts"
  chart            = "keda"
  version          = var.keda_version
  namespace        = "keda"
  create_namespace = true

  depends_on = [
    google_container_node_pool.main,
    google_compute_firewall.control_plane_webhooks,
  ]
}

# --- адреси середовищ ---

# Глобальна статична IP на кожне середовище. Статична — бо від неї рахується
# PUBLIC_BASE_URL (повернення з оплати, вебхук monobank, стрічка .ics), і вона
# відома ще ДО першого деплою. Так зникає курка-яйце, яку на Render
# закривав RENDER_EXTERNAL_URL.
resource "google_compute_global_address" "ingress" {
  for_each = var.environments

  name = "${var.name}-${each.key}-ip"

  depends_on = [google_project_service.this]
}

locals {
  hosts = {
    for k, env in var.environments :
    k => coalesce(env.domain, "${replace(google_compute_global_address.ingress[k].address, ".", "-")}.sslip.io")
  }

  db_host = google_sql_database_instance.main.private_ip_address

  db_urls = {
    for k, env in var.environments : k => {
      for db in env.databases :
      db => "postgres://${google_sql_user.env[k].name}:${random_password.db[k].result}@${local.db_host}:5432/${db}"
    }
  }
}

# --- namespace-и та секрети ---

resource "kubernetes_namespace_v1" "env" {
  for_each = var.environments

  metadata {
    name = each.value.namespace
    labels = {
      "app.kubernetes.io/part-of" = var.name
      "tutorflow/environment"     = each.key
    }
  }

  depends_on = [google_container_node_pool.main]
}

resource "random_password" "jwt" {
  for_each = var.environments

  length  = 48
  special = false
}

resource "random_password" "payment_token_key" {
  for_each = var.environments

  length  = 48
  special = false
}

# Спільний секрет внутрішніх маршрутів мікросервісів (/internal, ADR-0020).
# Моноліт його не читає — зайва змінна в його секреті нічого не коштує.
resource "random_password" "internal_token" {
  for_each = var.environments

  length  = 48
  special = false
}

# Секрети генеруються тут і лягають прямо в кластер. Їх ніхто не бачив і не
# вводив руками — як generateValue у render.yaml. Живуть вони в стані
# Terraform, тому стан — теж секрет (див. «Спільний стан» у README).
#
# ВАЖЛИВО, як і на Render: токен еквайрингу, збережений викладачем, зашифрований
# PAYMENT_TOKEN_KEY. Пересоздати ключ — означає втратити підключені токени.
resource "kubernetes_secret_v1" "app" {
  for_each = var.environments

  metadata {
    name      = "tutorflow-secrets"
    namespace = kubernetes_namespace_v1.env[each.key].metadata[0].name
  }

  data = merge(
    {
      # Перша база середовища — основна; для моноліту вона єдина.
      DATABASE_URL       = local.db_urls[each.key][each.value.databases[0]]
      JWT_SECRET         = random_password.jwt[each.key].result
      PAYMENT_TOKEN_KEY  = random_password.payment_token_key[each.key].result
      TELEGRAM_BOT_TOKEN = lookup(var.telegram_bot_tokens, each.key, "")
      # Порожній рядок означає «SMTP не налаштований»: застосунок переходить
      # на запис листів у лог і працює далі.
      SMTP_URL           = lookup(var.smtp_urls, each.key, "")
      INTERNAL_TOKEN     = random_password.internal_token[each.key].result
    },
    # Для мікросервісів: DATABASE_URL_SCHEDULING, DATABASE_URL_BILLING, ...
    {
      for db, url in local.db_urls[each.key] :
      "DATABASE_URL_${upper(replace(db, "-", "_"))}" => url
    },
  )
}

# Несекретне, але відоме лише платформі. Чарт підхоплює цю ConfigMap через
# envFrom, тож PUBLIC_BASE_URL не треба передавати при кожному деплої.
resource "kubernetes_config_map_v1" "platform" {
  for_each = var.environments

  metadata {
    name      = "tutorflow-platform"
    namespace = kubernetes_namespace_v1.env[each.key].metadata[0].name
  }

  data = {
    PUBLIC_BASE_URL = "https://${local.hosts[each.key]}"
  }
}
