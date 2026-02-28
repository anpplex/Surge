if ($request.method !== "POST") {
  $done({});
  return;
}

const newBody = {
  data: {
    maxMobileDistanceLimit: 15000,
    maxPathLimitGround: 30000,
    maxPathLimit: 30000,
    accuracyLimit: 31000,
    maxMobileDistanceLimitGround: 15000,
    accuracyLimitGround: 20000
  },
  errorMessage: "processed successfully.",
  errorCode: "mobile.service.foundation.010000"
};

$done({
  status: 200,
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(newBody)
});
