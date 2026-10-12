FROM node:24-alpine

# Install jq & bash
RUN apk add --no-cache jq bash dos2unix

# Copy Application
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
ENV DATABASE_URL=/tmp/dummy.db
RUN npm run build

# Remove Dev Dependencies
RUN npm prune --production

# Allow execution & Fix CRLF line endings (Windows to Linux)
# Allow execution & Fix CRLF line endings (Windows to Linux)
RUN dos2unix /app/run.sh && chmod a+x /app/run.sh

ENTRYPOINT [ "/app/run.sh" ]
