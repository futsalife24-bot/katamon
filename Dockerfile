# Production-only image for the Content Studio server distribution.
# Build from the repository root:
# docker build -f tools/content-studio/Dockerfile --build-arg SOURCE_SHA=$(git rev-parse HEAD) .
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY tools/content-studio/package.json tools/content-studio/package-lock.json /src/tools/content-studio/
RUN cd /src/tools/content-studio && npm ci --ignore-scripts
COPY . /src
ARG SOURCE_SHA
ENV SOURCE_SHA=${SOURCE_SHA}
RUN cd /src/tools/content-studio && npm run production:build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
COPY --from=build /src/tools/content-studio/production ./production
EXPOSE 8080
CMD ["node", "production/server.mjs"]
