resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = var.name
  format        = "DOCKER"

  # Кожен деплой — новий тег. Без прибирання сховище росте без меж і
  # потроху їсть кредити.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "2592000s" # 30 днів
    }
  }

  depends_on = [google_project_service.this]
}

# Збірка в Cloud Build (infra/deploy.sh --cloud-build) іде від імені
# дефолтного compute SA. У проєктах, створених після 2024 року, він уже не має
# ролі Editor автоматично, тож права видаються явно.
locals {
  cloudbuild_sa = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
}

resource "google_project_iam_member" "cloudbuild" {
  for_each = toset([
    "roles/artifactregistry.writer",
    "roles/logging.logWriter",
    "roles/storage.objectViewer",
  ])

  project = var.project_id
  role    = each.value
  member  = local.cloudbuild_sa

  depends_on = [google_project_service.this]
}
