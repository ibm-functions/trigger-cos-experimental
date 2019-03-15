FROM node:10.15.3

ADD package.json /
RUN cd / && npm install --production

ADD provider/. /cosTrigger/

EXPOSE 8080

# Run the app
CMD ["/bin/bash", "-c", "node /cosTrigger/app.js"]
