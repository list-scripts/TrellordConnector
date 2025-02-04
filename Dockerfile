FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json /app

# Install dependencies
RUN npm install --omit=dev

# Copy the rest of the application files
COPY . /app

# Create config directory
RUN mkdir -p /app/config

# Command to start the application
CMD ["node", "/app/server.js"]