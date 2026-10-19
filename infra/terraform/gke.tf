# Окремий сервісний акаунт для вузлів із мінімальними ролями — замість
# дефолтного compute SA, у якого роль Editor на весь проєкт.
resource "google_service_account" "nodes" {
  account_id   = "${var.name}-nodes"
  display_name = "GKE nodes (${var.name})"
}

resource "google_project_iam_member" "nodes" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/monitoring.viewer",
    "roles/stackdriver.resourceMetadata.writer",
    "roles/autoscaling.metricsWriter",
    "roles/artifactregistry.reader",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.nodes.email}"
}

# GKE Standard, зональний. Чому не Autopilot і не Cloud Run — див.
# docs/adr/0016-gcp-deployment.md. Коротко: воркер, бот і Redis — довгоживучі
# процеси без HTTP, а лаба 4 — це KEDA і CronJob, тобто Kubernetes.
resource "google_container_cluster" "main" {
  name     = var.name
  location = var.zone

  network    = google_compute_network.main.id
  subnetwork = google_compute_subnetwork.gke.id

  # Дефолтний пул неможливо налаштувати після створення — його одразу прибирають
  # і створюють власний (google_container_node_pool.main).
  remove_default_node_pool = true
  initial_node_count       = 1

  deletion_protection = var.deletion_protection

  networking_mode = "VPC_NATIVE"
  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  # Приватні вузли, публічний endpoint API: kubectl і helm працюють з ноутбука,
  # а самі вузли ззовні не видно.
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
  }

  release_channel {
    channel = "REGULAR"
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  addons_config {
    http_load_balancing {
      disabled = false
    }
    horizontal_pod_autoscaling {
      disabled = false
    }
  }

  # Логи контейнерів ідуть у Cloud Logging, метрики — у Cloud Monitoring і
  # Managed Prometheus. Для лаби 4 це «збирати інформацію про розгорнуті
  # застосунки» без жодного агента, встановленого руками.
  logging_config {
    enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS"]
  }
  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS"]
    managed_prometheus {
      enabled = true
    }
  }

  depends_on = [google_project_service.this]
}

resource "google_container_node_pool" "main" {
  name     = "main"
  cluster  = google_container_cluster.main.id
  location = var.zone

  initial_node_count = var.node_min

  # Cluster autoscaler: вузол додається, коли поду нема куди сісти (наприклад,
  # KEDA підняла п'ять воркерів), і прибирається, коли він порожній.
  autoscaling {
    min_node_count = var.node_min
    max_node_count = var.node_max
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  node_config {
    machine_type = var.machine_type
    spot         = var.spot
    disk_size_gb = 30
    disk_type    = "pd-standard"

    service_account = google_service_account.nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
    tags            = ["${var.name}-node"]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    shielded_instance_config {
      enable_secure_boot = true
    }

    labels = {
      app = var.name
    }
  }

  depends_on = [google_project_iam_member.nodes]
}
