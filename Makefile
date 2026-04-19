.PHONY: ci lint-rust fmt-rust test-rust test-rust-integration lint-ts typecheck-ts test-ts

ci: lint-rust fmt-rust test-rust test-rust-integration lint-ts typecheck-ts test-ts

lint-rust:
	cd backend && cargo clippy --release -- -D warnings

fmt-rust:
	cd backend && cargo fmt -- --check

test-rust:
	cd backend && cargo test --release

test-rust-integration:
	./scripts/run-backend-integration-tests.sh

lint-ts:
	cd frontend && pnpm exec eslint .

typecheck-ts:
	cd frontend && pnpm exec tsc --noEmit

test-ts:
	cd frontend && pnpm exec vitest run
