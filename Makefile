.PHONY: ci lint-rust fmt-rust test-rust lint-ts typecheck-ts test-ts

ci: lint-rust fmt-rust test-rust lint-ts typecheck-ts test-ts

lint-rust:
	cd backend && cargo clippy --release -- -D warnings

fmt-rust:
	cd backend && cargo fmt -- --check

test-rust:
	cd backend && cargo test --release

lint-ts:
	cd frontend && pnpm exec eslint .

typecheck-ts:
	cd frontend && pnpm exec tsc --noEmit

test-ts:
	cd frontend && pnpm exec vitest run
