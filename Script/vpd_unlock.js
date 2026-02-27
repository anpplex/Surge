function main(response) {
    try {
        if (!response || !response.body) {
            $surge.log("⚠️ 响应体为空", "vpd-bypass");
            return response;
        }

        let body = JSON.parse(response.body);

        if (body && body.data && typeof body.data === 'object') {
            body.data.maxMobileDistanceLimit = 15000;
            body.data.maxMobileDistanceLimitGround = 15000;
            body.data.maxPathLimit = 300000;
            $surge.log("✅ 成功修改 VPD 合规检查参数", "vpd-bypass");
        }

        response.body = JSON.stringify(body);
        return response;

    } catch (error) {
        $surge.log("❌ 脚本执行异常: " + error.message, "vpd-bypass");
        return response;
    }
}
