# Sofie playout gateway with the Open Live TSR plugin baked in.
ARG GATEWAY_IMAGE=ghcr.io/sofie-automation/sofie-core-playout-gateway:v26.9.2

FROM node:22 AS build
WORKDIR /opt/sofie-tsr-open-live
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev && rm -rf src scripts .git

FROM ${GATEWAY_IMAGE}
ENV TSR_PLUGIN_PATHS=/opt/sofie-tsr-open-live
COPY --from=build /opt/sofie-tsr-open-live /opt/sofie-tsr-open-live
