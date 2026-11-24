# Node 25 and later no longer bundle Corepack, so it is installed at a pinned
# version. Corepack then runs the pnpm release named in package.json's
# "packageManager" field.
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build-step
ARG DYNAMIC_CONFIG=true
ARG historyMode="history"
ARG SB_CONFIG=""
ENV DYNAMIC_CONFIG="${DYNAMIC_CONFIG}"
ENV SB_historyMode="${historyMode}"
ENV SB_CONFIG="${SB_CONFIG}"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# The "prepare" script runs husky, which installs git hooks. The build
# context has no .git, so skip it.
ENV HUSKY=0

RUN npm install --global corepack@0.36.0 && corepack enable pnpm

WORKDIR /app
# Dependency manifests come before the source so the install layer is cached
# until one of them changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN \[ "${DYNAMIC_CONFIG}" == "true" \] && sed -i 's/<!--RC//;s/RC-->//' index.html
RUN pnpm run build


FROM nginxinc/nginx-unprivileged:1-alpine
ARG pathPrefix="/"

USER root
RUN apk add --no-cache jq pcre-tools

COPY ./config.schema.json /etc/nginx/conf.d/config.schema.json
COPY --from=build-step /app/dist /usr/share/nginx/html
COPY --from=build-step /app/docker/default.conf /etc/nginx/conf.d/default.conf.template
ADD docker/docker-entrypoint.sh /docker-entrypoint.d/40-stac-browser-entrypoint.sh

# Remove default.conf so a skipped entrypoint fails loudly instead of serving nginx's welcome page.
RUN rm -f /etc/nginx/conf.d/default.conf && \
    chown -R nginx:nginx /usr/share/nginx/html && \
    chmod +x /docker-entrypoint.d/40-stac-browser-entrypoint.sh

ENV SB_pathPrefix="${pathPrefix}"

EXPOSE 8080

STOPSIGNAL SIGTERM

USER nginx
