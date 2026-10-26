region             = "us-east-1"
image              = "ghcr.io/dovetail/lasso:0.1.0"
vpc_id             = "vpc-0123456789abcdef0"
alb_subnet_ids     = ["subnet-aaa", "subnet-bbb"]
service_subnet_ids = ["subnet-ccc", "subnet-ddd"]
certificate_arn    = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
allowed_cidrs      = ["10.0.0.0/8"]

environment = {
  LASSO_BASE_URL       = "https://lasso.example.com"
  LASSO_AUTH_MODE      = "oidc"
  OIDC_ISSUER          = "https://accounts.google.com"
  OIDC_CLIENT_ID       = "1234.apps.googleusercontent.com"
  OIDC_ALLOWED_DOMAINS = "example.com"
  GITHUB_ORG           = "example"
}

# One JSON secret in Secrets Manager holding every sensitive value.
secrets = {
  DATABASE_URL             = "arn:aws:secretsmanager:us-east-1:123456789012:secret:lasso-AbCdEf:DATABASE_URL::"
  LASSO_SESSION_SECRET     = "arn:aws:secretsmanager:us-east-1:123456789012:secret:lasso-AbCdEf:LASSO_SESSION_SECRET::"
  OIDC_CLIENT_SECRET       = "arn:aws:secretsmanager:us-east-1:123456789012:secret:lasso-AbCdEf:OIDC_CLIENT_SECRET::"
  CURSOR_API_KEY           = "arn:aws:secretsmanager:us-east-1:123456789012:secret:lasso-AbCdEf:CURSOR_API_KEY::"
  CLAUDE_ANALYTICS_API_KEY = "arn:aws:secretsmanager:us-east-1:123456789012:secret:lasso-AbCdEf:CLAUDE_ANALYTICS_API_KEY::"
  CLAUDE_ADMIN_API_KEY     = "arn:aws:secretsmanager:us-east-1:123456789012:secret:lasso-AbCdEf:CLAUDE_ADMIN_API_KEY::"
  GITHUB_TOKEN             = "arn:aws:secretsmanager:us-east-1:123456789012:secret:lasso-AbCdEf:GITHUB_TOKEN::"
}
