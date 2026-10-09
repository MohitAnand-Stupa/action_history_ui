# Build the React UI, then serve it with the read-only Python API.
# .env is never baked in: mount it at run time (see README, "Deploy with Docker").
# Base images come from the ECR Public mirror of Docker Hub, which needs no login.
FROM public.ecr.aws/docker/library/node:22-alpine AS ui
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM public.ecr.aws/docker/library/python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir psycopg2-binary
COPY serve.py ./
COPY --from=ui /app/dist ./dist
USER nobody
# Listens on every interface, so serve.py refuses to start without VIEWER_USER/VIEWER_PASSWORD.
CMD ["python3", "serve.py", "--host", "0.0.0.0", "--port", "8090", "--env-file", "/app/.env"]
