output "project_id" {
  value = var.project_id
}

output "region" {
  value = var.region
}

output "zone" {
  value = var.zone
}

output "cluster_name" {
  value = google_container_cluster.main.name
}

output "registry" {
  description = "Куди пушити образи"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "environments" {
  description = "Що потрібно deploy.sh для кожного середовища"
  value = {
    for k, env in var.environments : k => {
      namespace      = env.namespace
      host           = local.hosts[k]
      url            = "https://${local.hosts[k]}"
      static_ip_name = google_compute_global_address.ingress[k].name
      static_ip      = google_compute_global_address.ingress[k].address
    }
  }
}

output "sql_instance" {
  value = google_sql_database_instance.main.connection_name
}

output "get_credentials" {
  description = "Команда, яка налаштовує kubectl на цей кластер"
  value       = "gcloud container clusters get-credentials ${google_container_cluster.main.name} --zone ${var.zone} --project ${var.project_id}"
}
