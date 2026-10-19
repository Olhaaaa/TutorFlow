# Керований PostgreSQL 17 — замість Neon у лабі 1 і контейнера postgres у
# компоузі лаби 2. Версія та сама, тож міграції поводяться однаково.
resource "google_sql_database_instance" "main" {
  name             = "${var.name}-pg"
  database_version = "POSTGRES_17"
  region           = var.region

  deletion_protection = var.deletion_protection

  settings {
    # Для PostgreSQL 16+ типова редакція — ENTERPRISE_PLUS, а вона не дає
    # дешевих тарифів. db-f1-micro існує лише в ENTERPRISE.
    edition           = "ENTERPRISE"
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    location_preference {
      zone = var.zone
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.main.id
      # Трафік не виходить із VPC. Хто захоче TLS і до приватної адреси —
      # ENCRYPTED_ONLY плюс ?sslmode=require у DATABASE_URL.
      ssl_mode = "ALLOW_UNENCRYPTED_AND_ENCRYPTED"
    }

    backup_configuration {
      enabled    = true
      start_time = "03:00"
    }

    # Пул у застосунку — max 10 з'єднань на процес (database.module.ts). На
    # f1-micro типовий ліміт ~25: два поди API і воркер його вже вичерпують,
    # а при масштабуванні KEDA і HPA — тим паче.
    database_flags {
      name  = "max_connections"
      value = "100"
    }

    # Query Insights: найповільніші запити видно в консолі без pg_stat_statements
    # руками — знадобиться в лабі 3 для порівняння під k6.
    insights_config {
      query_insights_enabled = true
    }
  }

  depends_on = [google_service_networking_connection.psa]
}

locals {
  # monolith/tutorflow, microservices/scheduling, ... → плоский перелік баз.
  # Ключ — ім'я бази: два середовища з однаковим ім'ям бази дадуть помилку
  # «Duplicate object key» ще на plan, а не тиху спільну базу.
  databases = {
    for p in flatten([
      for env_key, env in var.environments : [
        for db in env.databases : { env = env_key, db = db }
      ]
    ]) : p.db => p
  }
}

resource "random_password" "db" {
  for_each = var.environments

  length  = 32
  special = false # пароль іде в URL — без символів, які треба екранувати
}

resource "google_sql_user" "env" {
  for_each = var.environments

  name     = each.key
  instance = google_sql_database_instance.main.name
  password = random_password.db[each.key].result

  deletion_policy = "ABANDON"
}

resource "google_sql_database" "db" {
  for_each = local.databases

  name     = each.key
  instance = google_sql_database_instance.main.name

  deletion_policy = "ABANDON"
}
