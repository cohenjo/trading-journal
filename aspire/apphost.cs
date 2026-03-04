#:sdk Aspire.AppHost.Sdk@13.1.0
#:package Aspire.Hosting.PostgreSQL@13.1.0
#:package Aspire.Hosting.Python@13.1.0
#:package Aspire.Hosting.JavaScript@13.1.0

var builder = DistributedApplication.CreateBuilder(args);
var runIbGateway = string.Equals(
    Environment.GetEnvironmentVariable("RUN_IB_GATEWAY"),
    "true",
    StringComparison.OrdinalIgnoreCase);

// Keep the existing local Postgres version and database shape.
var dbUser = builder.AddParameter("db-user", value: "user", publishValueAsDefault: true, secret: false);
var dbPassword = builder.AddParameter("db-password", value: "password", publishValueAsDefault: false, secret: true);

var database = builder.AddPostgres("db", userName: dbUser, password: dbPassword)
    .WithImageTag("13")
    .WithHostPort(5432)
    .WithEnvironment("POSTGRES_DB", "trading-journal")
    .WithDataBindMount("../trading-journal-data")
    .AddDatabase("trading-journal");

var backend = builder.AddUvicornApp("backend", "../apps/backend", "main:app")
    .WithUv()
    .WithEnvironment("DATABASE_URL", database.Resource.ConnectionStringExpression)
    .WithEnvironment("OTEL_SERVICE_NAME", "trading-journal-backend")
    .WithEnvironment("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc")
    .WithEnvironment("OTEL_EXPORTER_OTLP_ENDPOINT", "http://host.docker.internal:4317")
    .WithReference(database)
    .WaitFor(database);

builder.AddJavaScriptApp("frontend", "../apps/frontend")
    .WithEnvironment("NEXT_PUBLIC_API_URL", backend.GetEndpoint("http"))
    .WithReference(backend)
    .WaitFor(backend);

if (runIbGateway)
{
    var twsUserid = builder.AddParameter("TWS-USERID");
    var twsPassword = builder.AddParameter("TWS-PASSWORD", secret: true);

    builder.AddContainer("ib-gateway", "ghcr.io/gnzsnz/ib-gateway", "latest")
        .WithEnvironment("TWS_USERID", twsUserid)
        .WithEnvironment("TWS_PASSWORD", twsPassword)
        .WithEnvironment("TRADING_MODE", "paper")
        .WithEnvironment("READ_ONLY_API", "no")
        .WithEnvironment("TWOFA_TIMEOUT_ACTION", "restart")
        .WithEnvironment("AUTO_RESTART_TIME", "11:59 PM")
        .WithEnvironment("RELOGIN_AFTER_TWOFA_TIMEOUT", "yes")
        .WithEnvironment("TIME_ZONE", "Asia/Jerusalem")
        .WithEndpoint(port: 4001, targetPort: 4003)
        .WithEndpoint(port: 4002, targetPort: 4004);
}

builder.Build().Run();
