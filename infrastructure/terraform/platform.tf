data "aws_region" "current" {}

module "ctx" {
  source = "git::https://github.com/chris-arsenault/ahara-tf-patterns.git//modules/platform-context"
}

module "cognito" {
  source  = "git::https://github.com/chris-arsenault/ahara-tf-patterns.git//modules/cognito-app"
  name    = local.cognito_client_name
  cognito = module.ctx.cognito
}

resource "aws_ssm_parameter" "cognito_client_id" {
  name  = "${local.ssm_prefix}/cognito/clients/${local.cognito_client_name}"
  type  = "String"
  value = module.cognito.client_id
}

resource "aws_ssm_parameter" "auth_trigger_client" {
  name  = "${local.ssm_prefix}/auth-trigger/clients/${local.auth_trigger_app_name}"
  type  = "String"
  value = module.cognito.client_id
}
