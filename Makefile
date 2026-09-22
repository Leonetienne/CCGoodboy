IMAGE := cc-good-boy-build
NODE_MODULES_VOLUME := cc-good-boy-node-modules
RUN := docker run --rm \
	-v "$(CURDIR)":/app \
	-v $(NODE_MODULES_VOLUME):/app/node_modules \
	-w /app \
	$(IMAGE)

.PHONY: image build dev test test-e2e typecheck shell clean lock

image:
	docker build -t $(IMAGE) .

lock: image
	$(RUN) npm install

build: image
	$(RUN) npm run build

dev: image
	$(RUN) npm run dev

test: image
	$(RUN) npm test

test-e2e: image
	$(RUN) npm run test:e2e

typecheck: image
	$(RUN) npm run typecheck

shell: image
	docker run --rm -it \
		-v "$(CURDIR)":/app \
		-v $(NODE_MODULES_VOLUME):/app/node_modules \
		-w /app \
		$(IMAGE) bash

clean:
	docker volume rm $(NODE_MODULES_VOLUME) 2>/dev/null || true
	rm -rf dist
