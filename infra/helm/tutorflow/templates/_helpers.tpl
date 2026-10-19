{{/* Селектор компонента. Не змінюється між релізами — інакше Deployment не оновиться. */}}
{{- define "tutorflow.selector" -}}
app.kubernetes.io/name: tutorflow
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "tutorflow.labels" -}}
{{ include "tutorflow.selector" . }}
app.kubernetes.io/part-of: tutorflow
app.kubernetes.io/version: {{ .ctx.Values.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .ctx.Release.Service }}
helm.sh/chart: {{ .ctx.Chart.Name }}-{{ .ctx.Chart.Version }}
{{- end }}

{{- define "tutorflow.image" -}}
{{ required "image.repository не задано — див. infra/deploy.sh" .Values.image.repository }}:{{ required "image.tag не задано" .Values.image.tag }}
{{- end }}

{{/*
Оточення застосунку. Порядок має значення: пізніше джерело перекриває раніше.
Платформна ConfigMap необов'язкова — без неї застосунок працює «без адреси».
*/}}
{{- define "tutorflow.envFrom" -}}
envFrom:
  - configMapRef:
      name: {{ .Release.Name }}-config
  - configMapRef:
      name: {{ .Values.platformConfigMap }}
      optional: true
  - secretRef:
      name: {{ .Values.secretName }}
{{- end }}

{{/* Образ ставить USER node (uid 1000). */}}
{{- define "tutorflow.podSecurity" -}}
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
{{- end }}

{{/*
Deployment воркера. Один шаблон на всі режими: різниця лише в ролях і кількості
реплік. strategy: Recreate — навмисно: при RollingUpdate старий і новий под
якийсь час живуть разом, і для ролі bot це два getUpdates одночасно (409 від
Telegram).
*/}}
{{- define "tutorflow.worker" -}}
{{- $ctx := .ctx -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ $ctx.Release.Name }}-{{ .component }}
  labels:
    {{- include "tutorflow.labels" (dict "ctx" $ctx "component" .component) | nindent 4 }}
spec:
  {{- if hasKey . "replicas" }}
  replicas: {{ .replicas }}
  {{- end }}
  strategy:
    type: Recreate
  selector:
    matchLabels:
      {{- include "tutorflow.selector" (dict "ctx" $ctx "component" .component) | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "tutorflow.labels" (dict "ctx" $ctx "component" .component) | nindent 8 }}
      annotations:
        checksum/config: {{ include (print $ctx.Template.BasePath "/configmap.yaml") $ctx | sha256sum }}
    spec:
      {{- include "tutorflow.podSecurity" $ctx | nindent 6 }}
      # Воркер дочитує поточне повідомлення й завершує прохід — див. SIGTERM у worker.ts
      terminationGracePeriodSeconds: 60
      containers:
        - name: worker
          image: {{ include "tutorflow.image" $ctx }}
          imagePullPolicy: {{ $ctx.Values.image.pullPolicy }}
          command: ["node", "services/api/dist/worker.js"]
          {{- include "tutorflow.envFrom" $ctx | nindent 10 }}
          env:
            - name: WORKER_ROLES
              value: {{ .roles | quote }}
          resources:
            {{- toYaml $ctx.Values.worker.resources | nindent 12 }}
{{- end }}

{{/*
Ім'я ManagedCertificate залежить від хоста. Якщо змінити domains у наявного
сертифіката, GKE намагається перестворити той самий sslCertificate, поки його
тримає балансувальник, і застрягає на resourceInUseByAnotherResource — старий
сертифікат так і лишається. Новий хост → нове ім'я → новий ресурс; старий
Helm видаляє, і контролер прибирає його вже після від'єднання.
*/}}
{{- define "tutorflow.certName" -}}
{{ .Release.Name }}-cert-{{ .Values.ingress.host | sha256sum | trunc 8 }}
{{- end }}
