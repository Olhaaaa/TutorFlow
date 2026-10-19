{{/* Селектор компонента. Не змінюється між релізами — інакше Deployment не оновиться. */}}
{{- define "ms.selector" -}}
app.kubernetes.io/name: tutorflow-ms
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "ms.labels" -}}
{{ include "ms.selector" . }}
app.kubernetes.io/part-of: tutorflow
app.kubernetes.io/version: {{ .ctx.Values.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .ctx.Release.Service }}
helm.sh/chart: {{ .ctx.Chart.Name }}-{{ .ctx.Chart.Version }}
{{- end }}

{{- define "ms.image" -}}
{{ required "image.repository не задано — див. infra/deploy.sh" .Values.image.repository }}:{{ required "image.tag не задано" .Values.image.tag }}
{{- end }}

{{/*
Оточення, спільне для всіх процесів. Порядок важливий: пізніше джерело
перекриває раніше, а явний `env` у контейнері перекриває все.
*/}}
{{- define "ms.envFrom" -}}
envFrom:
  - configMapRef:
      name: {{ .Release.Name }}-config
  - configMapRef:
      name: {{ .Values.platformConfigMap }}
      optional: true
  - secretRef:
      name: {{ .Values.secretName }}
{{- end }}

{{/*
DATABASE_URL конкретного сервіса. У секреті від Terraform лежать
DATABASE_URL_IDENTITY, _SCHEDULING, … — тут кожен процес отримує свою під
звичним ім'ям, яке читає спільний config.ts. Так у compose кожен контейнер
отримує адресу власного Postgres.
*/}}
{{- define "ms.databaseEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .ctx.Values.secretName }}
      key: DATABASE_URL_{{ upper .database }}
{{- end }}

{{/* Образ ставить USER node (uid 1000). */}}
{{- define "ms.podSecurity" -}}
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
{{- end }}

{{- define "ms.httpProbes" -}}
readinessProbe:
  httpGet: { path: /healthz, port: http }
  periodSeconds: 10
  failureThreshold: 3
startupProbe:
  httpGet: { path: /healthz, port: http }
  periodSeconds: 3
  failureThreshold: 30
livenessProbe:
  httpGet: { path: /healthz, port: http }
  periodSeconds: 20
  failureThreshold: 3
{{- end }}

{{/*
HTTP-сервіс: Deployment + Service (порт 8080, як у compose) + HPA.
Параметри: ctx, name, database (порожньо — без власної бази), autoscaling, resources.
*/}}
{{- define "ms.httpService" -}}
{{- $ctx := .ctx -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .name }}
  labels:
    {{- include "ms.labels" (dict "ctx" $ctx "component" .name) | nindent 4 }}
spec:
  selector:
    matchLabels:
      {{- include "ms.selector" (dict "ctx" $ctx "component" .name) | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "ms.labels" (dict "ctx" $ctx "component" .name) | nindent 8 }}
      annotations:
        checksum/config: {{ include (print $ctx.Template.BasePath "/configmap.yaml") $ctx | sha256sum }}
    spec:
      {{- include "ms.podSecurity" $ctx | nindent 6 }}
      terminationGracePeriodSeconds: 30
      containers:
        - name: {{ .name }}
          image: {{ include "ms.image" $ctx }}
          imagePullPolicy: {{ $ctx.Values.image.pullPolicy }}
          command: ["node", "services/api/dist/lab3/main.js", {{ .name | quote }}]
          ports:
            - name: http
              containerPort: 8080
          {{- include "ms.envFrom" $ctx | nindent 10 }}
          {{- if .database }}
          env:
            {{- include "ms.databaseEnv" (dict "ctx" $ctx "database" .database) | nindent 12 }}
          {{- end }}
          {{- include "ms.httpProbes" $ctx | nindent 10 }}
          resources:
            {{- toYaml .resources | nindent 12 }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  labels:
    {{- include "ms.labels" (dict "ctx" $ctx "component" .name) | nindent 4 }}
  {{- if eq .name "gateway" }}
  annotations:
    cloud.google.com/neg: '{"ingress": true}'
    cloud.google.com/backend-config: '{"default": "gateway"}'
  {{- end }}
spec:
  type: ClusterIP
  selector:
    {{- include "ms.selector" (dict "ctx" $ctx "component" .name) | nindent 4 }}
  ports:
    - name: http
      port: 8080
      targetPort: http
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ .name }}
  labels:
    {{- include "ms.labels" (dict "ctx" $ctx "component" .name) | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ .name }}
  minReplicas: {{ .autoscaling.minReplicas }}
  maxReplicas: {{ .autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ $ctx.Values.targetCPUUtilizationPercentage }}
{{- end }}

{{/*
Ім'я ManagedCertificate залежить від хоста — той самий прийом, що в чарті
моноліту: зміна domains у наявного сертифіката застрягає на
resourceInUseByAnotherResource, а новий хост → нове ім'я → новий ресурс.
*/}}
{{- define "ms.certName" -}}
{{ .Release.Name }}-cert-{{ .Values.ingress.host | sha256sum | trunc 8 }}
{{- end }}
