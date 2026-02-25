/*
 * @name Huawei VPD Distance Unlock
 * @description 修改华为泊车服务返回的距离限制，实测数值3000单位为米（车机端可能按厘米解析或有除100逻辑）
 * @author Anpple
 * @license MIT
 */

// 1. 获取原始响应体
let body;
try {
    body = $response.body;
    if (!body) throw new Error("Empty response body");
} catch (e) {
    console.log(`[VPD Unlock] Error: 获取响应体失败 - ${e.message}`);
    $done({});
    return;
}

let obj;
try {
    // 2. 解析 JSON
    obj = JSON.parse(body);
    
    // 3. 修改数据
    // 注意：根据用户反馈，此处数值3000对应车机端的3000米
    // 如果车机报错，可能需要调整数值范围（例如改为 200-500 之间）
    if (obj && obj.data) {
        obj.data.maxMobileDistanceLimit = 3000;       // 最大移动距离
        obj.data.maxPathLimit = 3000;                 // 最大路径长度
        obj.data.maxMobileDistanceLimitGround = 3000; // 地面最大移动距离
        obj.data.maxPathLimitGround = 3000;           // 地面最大路径长度
        obj.data.accuracyLimit = 3100;                // 精度限制 (通常单位不同，保留原配置)
        obj.data.accuracyLimitGround = 2000;          // 地面精度限制
        
        console.log(`[VPD Unlock] Success: 已修改距离限制为 3000`);
    } else {
        console.log(`[VPD Unlock] Warning: 响应结构不匹配，未找到 data 字段`);
    }
} catch (e) {
    console.log(`[VPD Unlock] Error: 处理响应失败 - ${e.message}`);
}

// 4. 写回修改后的数据
$done({body: JSON.stringify(obj)});
