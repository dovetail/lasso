variable "name" {
  description = "Name prefix for all resources."
  type        = string
  default     = "lasso"
}

variable "region" {
  type = string
}

variable "image" {
  description = "Container image, e.g. ghcr.io/dovetail/lasso:0.1.0"
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "alb_subnet_ids" {
  description = "Subnets for the load balancer (public for internet-facing, private for internal)."
  type        = list(string)
}

variable "service_subnet_ids" {
  description = "Private subnets for the Fargate tasks. They need a route to the internet (NAT) to reach the Cursor, Claude and GitHub APIs."
  type        = list(string)
}

variable "internal_alb" {
  description = "Keep the load balancer internal (reachable only from your network or VPN)."
  type        = bool
  default     = true
}

variable "allowed_cidrs" {
  description = "CIDRs allowed to reach the load balancer."
  type        = list(string)
  default     = ["10.0.0.0/8"]
}

variable "certificate_arn" {
  description = "ACM certificate for the HTTPS listener."
  type        = string
}

variable "cpu" {
  type    = number
  default = 512
}

variable "memory" {
  type    = number
  default = 1024
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "environment" {
  description = "Non-sensitive environment variables (LASSO_BASE_URL, OIDC_ISSUER, OIDC_CLIENT_ID, GITHUB_ORG, ...)."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = <<-EOT
    Sensitive environment variables, mapped to Secrets Manager or SSM Parameter Store ARNs.
    For a key inside a JSON secret use "arn:aws:secretsmanager:...:secret:lasso-abc123:CURSOR_API_KEY::".
    Must include DATABASE_URL and LASSO_SESSION_SECRET.
  EOT
  type        = map(string)
}

variable "database_security_group_id" {
  description = "Optional security group of your Postgres instance. If set, the service is allowed to connect on 5432."
  type        = string
  default     = ""
}

variable "log_retention_days" {
  type    = number
  default = 30
}
