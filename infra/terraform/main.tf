provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "current" {}

# Свіжий проєкт має вимкнені майже всі API. disable_on_destroy = false:
# destroy не повинен вимикати API, якими в проєкті може користуватись ще щось.
locals {
  services = [
    "compute.googleapis.com",
    "container.googleapis.com",
    "sqladmin.googleapis.com",
    "servicenetworking.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
  ]
}

resource "google_project_service" "this" {
  for_each = toset(local.services)

  service            = each.value
  disable_on_destroy = false
}
