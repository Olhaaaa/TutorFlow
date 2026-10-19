variable "project_id" {
  description = "ID проєкту в Google Cloud (не назва, а саме ID: my-project-123456)"
  type        = string
}

variable "region" {
  description = "Регіон. Варшава — найближчий до Києва, затримка ~20 мс"
  type        = string
  default     = "europe-central2"
}

variable "zone" {
  description = "Зона кластера й бази. Зональний кластер, а не регіональний: плату за керування одним зональним кластером покриває free tier GKE"
  type        = string
  default     = "europe-central2-a"
}

variable "name" {
  description = "Префікс імен ресурсів"
  type        = string
  default     = "tutorflow"
}

# --- вузли ---

variable "machine_type" {
  description = "Тип вузла. e2-standard-2 (2 vCPU, 8 ГБ): на e2-medium системні поди GKE з'їдають майже весь CPU"
  type        = string
  default     = "e2-standard-2"
}

variable "spot" {
  description = "Spot-вузли: у 3–4 рази дешевші, але Google може забрати вузол із попередженням за 30 с. Для лаби — так"
  type        = bool
  default     = true
}

variable "node_min" {
  description = "Мінімум вузлів для cluster autoscaler"
  type        = number
  default     = 1
}

variable "node_max" {
  description = "Максимум вузлів для cluster autoscaler. Обмежує й рахунок: більше вузлів autoscaler не дасть"
  type        = number
  default     = 3
}

# --- база ---

variable "db_tier" {
  description = "Тип інстанса Cloud SQL. db-f1-micro — найдешевший (спільне ядро, 0.6 ГБ)"
  type        = string
  default     = "db-f1-micro"
}

variable "deletion_protection" {
  description = "Захист кластера й бази від terraform destroy. Для лаби вимкнено, щоб усе прибиралось однією командою"
  type        = bool
  default     = false
}

# --- середовища застосунку ---

variable "environments" {
  description = <<-EOT
    Середовища, які ділять один кластер і один інстанс Cloud SQL. Кожне отримує
    свій namespace, свого користувача БД, свої бази, свою статичну IP-адресу з
    сертифікатом і свої згенеровані секрети.

    Моноліт (лаба 2) — одна база. Мікросервіси (лаба 3) додаються сюди ж окремим
    ключем зі своїм переліком баз: так обидві версії живуть на однаковому
    залізі, і порівняння в лабі 3 чесне.

    domain — свій домен. Без нього адреса буде <ip-через-дефіси>.sslip.io:
    такий DNS резолвиться сам у свою IP, і Google видає на нього сертифікат.
  EOT
  type = map(object({
    namespace = string
    databases = list(string)
    domain    = optional(string)
  }))
  default = {
    monolith = {
      namespace = "tutorflow"
      databases = ["tutorflow"]
    }
  }

  validation {
    condition     = alltrue([for k in keys(var.environments) : can(regex("^[a-z][a-z0-9-]{0,20}$", k))])
    error_message = "Ключі середовищ: малі латинські літери, цифри й дефіс, до 21 символу — з них складаються імена ресурсів."
  }
}

variable "telegram_bot_tokens" {
  description = <<-EOT
    Токени ботів Telegram за ключем середовища. Необов'язково. Кожному середовищу
    — СВІЙ бот: Telegram не дає getUpdates з двох процесів, тож моноліт і
    мікросервіси на одному токені вибивали б один одного.
  EOT
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "keda_version" {
  description = "Версія чарту KEDA. null — остання на момент apply; для відтворюваності варто зафіксувати"
  type        = string
  default     = null
}
