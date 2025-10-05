.PHONY: help dev prod build stop status logs clean migrate test

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev: ## Start development environment
	@echo "🚀 Starting development environment..."
	docker-compose -f docker-compose.dev.yml up -d
	@echo ""
	@echo "✅ Development environment started successfully!"
	@echo ""
	@echo "📋 Service URLs:"
	@echo "🗄️  PostgreSQL: localhost:5433"
	@echo "🔧 pgAdmin: http://localhost:5050 (admin@admin.com / admin)"
	@echo "📊 Redis: localhost:6379"
	@echo "🎛️  Redis Commander: http://localhost:8081"
	@echo ""
	@echo "🏃 To start your NestJS app: npm run start:dev"
	@echo "📝 To run migrations: make migrate"

prod: ## Start production environment
	@echo "🚀 Starting production environment..."
	docker-compose up -d --build
	@echo "✅ Production environment started!"

stop: ## Stop all services
	@echo "🛑 Stopping all services..."
	docker-compose down
	docker-compose -f docker-compose.dev.yml down
	@echo "✅ All services stopped!"

restart: ## Restart development environment
	@echo "🔄 Restarting development environment..."
	make stop
	make dev

status: ## Show service status
	@echo "📊 Service Status:"
	docker-compose ps
	@echo ""
	docker-compose -f docker-compose.dev.yml ps

logs: ## Show logs from all services
	docker-compose -f docker-compose.dev.yml logs -f

logs-postgres: ## Show PostgreSQL logs only
	docker-compose -f docker-compose.dev.yml logs -f postgres-dev

logs-redis: ## Show Redis logs only
	docker-compose -f docker-compose.dev.yml logs -f redis-dev

logs-pgadmin: ## Show pgAdmin logs only
	docker-compose -f docker-compose.dev.yml logs -f pgadmin-dev

build: ## Build all Docker images
	@echo "🔨 Building Docker images..."
	docker-compose -f docker-compose.dev.yml build
	@echo "✅ Build complete!"

rebuild: ## Rebuild all images from scratch (no cache)
	@echo "🔨 Rebuilding Docker images (no cache)..."
	docker-compose -f docker-compose.dev.yml build --no-cache
	@echo "✅ Rebuild complete!"

migrate: ## Run database migrations
	@echo "🗃️  Running database migrations..."
	npm run migration:run
	@echo "✅ Migrations complete!"

migrate-generate: ## Generate a new migration
	@echo "📝 Generating new migration..."
	@read -p "Enter migration name: " name; \
	npm run migration:generate -- --name=$$name

migrate-revert: ## Revert the last migration
	@echo "↩️  Reverting last migration..."
	npm run migration:revert

seed: ## Run all seed scripts
	@echo "🌱 Seeding database..."
	npm run seed:resume-templates
	npm run seed:rate-limits
	npm run seed:subscription-plans
	@echo "✅ Database seeding complete!"

seed-templates: ## Seed resume templates only
	@echo "📄 Seeding resume templates..."
	npm run seed:resume-templates
	@echo "✅ Resume templates seeded!"

seed-limits: ## Seed rate limits only
	@echo "⚡ Seeding rate limits..."
	npm run seed:rate-limits
	@echo "✅ Rate limits seeded!"

seed-subscription-plans: ## Seed subscription plans only
	@echo "📅 Seeding subscription plans..."
	npm run seed:subscription-plans
	@echo "✅ Subscription plans seeded!"

clean: ## Remove all containers, volumes, and images
	@echo "🧹 Cleaning up Docker resources..."
	docker-compose down -v --remove-orphans
	docker-compose -f docker-compose.dev.yml down -v --remove-orphans
	docker system prune -f
	@echo "✅ Cleanup complete!"

clean-all: ## Remove everything including images and build cache
	@echo "🧹 Deep cleaning all Docker resources..."
	docker-compose down -v --remove-orphans --rmi all
	docker-compose -f docker-compose.dev.yml down -v --remove-orphans --rmi all
	docker system prune -af --volumes
	@echo "✅ Deep cleanup complete!"

test: ## Run tests
	npm run test

test-e2e: ## Run end-to-end tests
	npm run test:e2e

test-cov: ## Run tests with coverage
	npm run test:cov

install: ## Install dependencies
	npm install

db-reset: ## Reset database (clean + migrate + seed)
	@echo "🔄 Resetting database..."
	make clean
	make dev
	@echo "⏳ Waiting for database to be ready..."
	sleep 10
	make migrate
	make seed
	@echo "✅ Database reset complete!"

health: ## Check if all services are healthy
	@echo "🏥 Checking service health..."
	@echo "PostgreSQL:" && docker exec ats-fit-postgres-dev pg_isready -U postgres || echo "❌ PostgreSQL not ready"
	@echo "Redis:" && docker exec ats-fit-redis-dev redis-cli ping || echo "❌ Redis not ready"
	@echo "✅ Health check complete!"

shell-postgres: ## Open PostgreSQL shell
	docker exec -it ats-fit-postgres-dev psql -U postgres -d ats_fit

shell-redis: ## Open Redis shell
	docker exec -it ats-fit-redis-dev redis-cli

backup-db: ## Backup database
	@echo "💾 Creating database backup..."
	mkdir -p backups
	docker exec ats-fit-postgres-dev pg_dump -U postgres ats_fit > backups/ats_fit_$(shell date +%Y%m%d_%H%M%S).sql
	@echo "✅ Database backup created in backups/ directory"

restore-db: ## Restore database from backup (usage: make restore-db FILE=backup.sql)
	@if [ -z "$(FILE)" ]; then \
		echo "❌ Please specify a backup file: make restore-db FILE=backup.sql"; \
		exit 1; \
	fi
	@echo "📥 Restoring database from $(FILE)..."
	docker exec -i ats-fit-postgres-dev psql -U postgres -d ats_fit < $(FILE)
	@echo "✅ Database restore complete!"
