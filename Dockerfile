# Base image for both builder and runner
FROM node:latest AS base

# Install ffmpeg, sox
RUN apt-get update && \
    apt-get install -y ffmpeg sox && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Builder stage
FROM base AS builder

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and pnpm.lock
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy the rest of the project files
COPY . .

# Build the TypeScript code to JavaScript
RUN yarn build

# Final runtime image
FROM base

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy the package.json and yarn.lock files from the builder image
COPY --from=builder /usr/src/app/package.json /usr/src/app/yarn.lock ./

# Copy the built JavaScript files from the builder image
COPY --from=builder /usr/src/app/dist ./dist

# Expose the port your application listens on
EXPOSE 8080

# Start the application
CMD ["yarn", "start"]
