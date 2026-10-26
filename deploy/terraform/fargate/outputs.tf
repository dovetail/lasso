output "load_balancer_dns_name" {
  description = "Point your DNS record (LASSO_BASE_URL host) at this."
  value       = aws_lb.lasso.dns_name
}

output "service_security_group_id" {
  value = aws_security_group.service.id
}
