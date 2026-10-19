# Власна VPC замість default: діапазони подів і сервісів задані явно, і в
# мережі немає нічого, крім того, що тут описано.
resource "google_compute_network" "main" {
  name                    = "${var.name}-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.this]
}

resource "google_compute_subnetwork" "gke" {
  name          = "${var.name}-gke"
  region        = var.region
  network       = google_compute_network.main.id
  ip_cidr_range = "10.10.0.0/20"

  # VPC-native кластер: поди отримують адреси з мережі, а не з оверлею.
  # Саме це дає балансувальнику ходити прямо в поди (container-native NEG).
  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.20.0.0/14"
  }
  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.24.0.0/20"
  }

  private_ip_google_access = true
}

# Вузли приватні — без зовнішніх адрес. Вихід в інтернет (Telegram, monobank,
# Docker Hub для redis) іде через Cloud NAT.
resource "google_compute_router" "main" {
  name    = "${var.name}-router"
  region  = var.region
  network = google_compute_network.main.id
}

resource "google_compute_router_nat" "main" {
  name                               = "${var.name}-nat"
  router                             = google_compute_router.main.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# Private Service Access: діапазон, з якого Google видає приватну адресу
# інстансу Cloud SQL. База не має публічної IP узагалі — до неї дістаються
# лише з VPC, тобто з подів кластера.
resource "google_compute_global_address" "psa" {
  name          = "${var.name}-psa"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "psa" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.psa.name]
  # Без ABANDON destroy падає: Google не дає видалити пірінг, доки інстанс SQL
  # ще остаточно не прибраний на його боці.
  deletion_policy = "ABANDON"
}

# Control plane → вузли на портах вебхуків і metrics API. KEDA реєструє
# external metrics API (6443) і admission-вебхук (9443); у приватному кластері
# правило за замовчуванням відкриває лише 443 і 10250.
resource "google_compute_firewall" "control_plane_webhooks" {
  name      = "${var.name}-cp-webhooks"
  network   = google_compute_network.main.id
  direction = "INGRESS"

  source_ranges = ["${google_container_cluster.main.private_cluster_config[0].private_endpoint}/32"]
  target_tags   = ["${var.name}-node"]

  allow {
    protocol = "tcp"
    ports    = ["6443", "8443", "9443"]
  }
}
