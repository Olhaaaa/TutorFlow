terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.35"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Стан за замовчуванням локальний (terraform.tfstate поруч, у git не йде).
  # Для роботи вдвох стан треба винести в бакет — див. infra/README.md,
  # розділ «Спільний стан». Тоді розкоментувати й виконати `terraform init -migrate-state`.
  #
  # backend "gcs" {
  #   bucket = "<project-id>-tfstate"
  #   prefix = "tutorflow"
  # }
}
