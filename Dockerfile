FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root to install dependencies and copy files
USER root

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
# Tell Puppeteer to skip downloading Chrome while we are root
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install

# Copy all the rest of the application files
COPY . .

# Change ownership of the app directory to the pptruser
RUN chown -R pptruser:pptruser /app

# Switch back to the non-root user that comes with the Puppeteer image
USER pptruser

# Now download Chrome as the pptruser so it goes to the correct cache folder
RUN npx puppeteer browsers install chrome

# Expose port (Render automatically uses PORT environment variable)
EXPOSE 5000

# Start the application
CMD ["npm", "start"]
