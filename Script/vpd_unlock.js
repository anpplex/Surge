function main(response) {
    $surge.log("===== VPD Script Start =====", "vpd-debug");
    
    try {
        $surge.log("Step 1: Check response exists", "vpd-debug");
        if (!response) {
            $surge.log("Response is null", "vpd-debug");
            return response;
        }
        
        $surge.log("Step 2: Check response body", "vpd-debug");
        if (!response.body) {
            $surge.log("No response body", "vpd-debug");
            return response;
        }

        $surge.log("Step 3: Parse JSON - body length: " + response.body.length, "vpd-debug");
        let body = JSON.parse(response.body);
        
        $surge.log("Step 4: Check data field", "vpd-debug");
        if (!body || !body.data) {
            $surge.log("No data field found", "vpd-debug");
            return response;
        }

        $surge.log("Step 5: Modifying parameters", "vpd-debug");
        body.data.maxMobileDistanceLimit = 15000;
        body.data.maxMobileDistanceLimitGround = 15000;
        body.data.maxPathLimit = 300000;

        $surge.log("Step 6: Serialize back", "vpd-debug");
        response.body = JSON.stringify(body);
        
        $surge.log("===== VPD Script Success =====", "vpd-debug");
        return response;

    } catch (error) {
        $surge.log("===== Error: " + error.toString() + " =====", "vpd-debug");
        return response;
    }
}