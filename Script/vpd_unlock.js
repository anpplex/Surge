function main(response) {
    try {
        // 快速检查
        if (!response) {
            return response;
        }
        
        if (!response.body) {
            $surge.log("No response body", "vpd-bypass");
            return response;
        }

        // 安全的 JSON 解析，带超时保护
        let body;
        try {
            body = JSON.parse(response.body);
        } catch (e) {
            $surge.log("JSON parse error: " + e.message, "vpd-bypass");
            return response;
        }

        // 快速检查数据结构
        if (!body || typeof body !== 'object') {
            return response;
        }

        if (!body.data || typeof body.data !== 'object') {
            return response;
        }

        // 修改参数
        body.data.maxMobileDistanceLimit = 15000;
        body.data.maxMobileDistanceLimitGround = 15000;
        body.data.maxPathLimit = 300000;

        // 重新序列化
        response.body = JSON.stringify(body);
        $surge.log("VPD params modified", "vpd-bypass");

        return response;

    } catch (error) {
        $surge.log("Error: " + error.message, "vpd-bypass");
        return response;
    }
}