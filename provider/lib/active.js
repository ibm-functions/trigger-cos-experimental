// Licensed to the Apache Software Foundation (ASF) under one or more contributor
// license agreements; and to You under the Apache License, Version 2.0.

module.exports = function(logger, triggerManager) {

    // Active Endpoint
    this.endPoint = '/active';

    this.active = function(req, res) {
        var method = 'active';

        var response = {
            worker: triggerManager.worker,
            host: triggerManager.host,
            active: triggerManager.host === triggerManager.activeHost
        };

        if (req.query && req.query.active) {
            var query = req.query.active.toLowerCase();

            if (query !== 'true' && query !== 'false') {
                response.error = "Invalid query string";
                res.send(response);
                return;
            }

            var redundantHost = triggerManager.host === `${triggerManager.hostPrefix}0` ? `${triggerManager.hostPrefix}1` : `${triggerManager.hostPrefix}0`;
            var activeHost = query === 'true' ? triggerManager.host : redundantHost;
            if (triggerManager.activeHost !== activeHost) {
                if (triggerManager.redisClient) {
                    triggerManager.redisClient.hsetAsync(triggerManager.redisKey, triggerManager.redisField, activeHost)
                    .then(() => {
                        response.active = 'swapping';
                        triggerManager.redisClient.publish(triggerManager.redisKey, activeHost);
                        logger.info(method, 'Active host swap in progress');
                        res.send(response);
                    })
                    .catch(err => {
                        response.error = err;
                        res.send(response);
                    });
                }
                else {
                    response.active = triggerManager.host === activeHost;
                    triggerManager.activeHost = activeHost;
                    var message = 'The active state has changed';
                    logger.info(method, message, 'to', activeHost);
                    response.message = message;
                    res.send(response);
                }
            }
            else {
                res.send(response);
            }
        }
        else {
            res.send(response);
        }
    };

};
