// Licensed to the Apache Software Foundation (ASF) under one or more contributor
// license agreements; and to You under the Apache License, Version 2.0.

function getOpenWhiskConfig(triggerData) {
    if (triggerData.additionalData && triggerData.additionalData.iamApikey) {
        var iam = require('@ibm-functions/iam-token-manager');
        var tm = new iam({
            iamApikey: triggerData.additionalData.iamApikey,
            iamUrl: triggerData.additionalData.iamUrl
        });
        return {ignore_certs: true, namespace: triggerData.namespace, auth_handler: tm};
    }
    else {
        return {ignore_certs: true, namespace: triggerData.namespace, api_key: triggerData.apikey};
    }
}

function addAdditionalData(params) {
    var additionalData = {};

    if (params.__bx_creds && params.__bx_creds['cloud-object-storage']) {
        var cosCreds = params.__bx_creds['cloud-object-storage'];
        if (!params.apikey) {
            params.apikey = cosCreds.apikey;
        }
    }

    if (process.env.__OW_IAM_NAMESPACE_API_KEY) {
        additionalData.iamApikey = process.env.__OW_IAM_NAMESPACE_API_KEY;
        additionalData.iamUrl = process.env.__OW_IAM_API_URL;
        additionalData.namespaceCRN = process.env.__OW_NAMESPACE_CRN;
    }

    params.additionalData = JSON.stringify(additionalData);
}

module.exports = {
    'addAdditionalData': addAdditionalData,
    'getOpenWhiskConfig': getOpenWhiskConfig
};
