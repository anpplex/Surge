# 规则

## Plex

代理

```
RULE-SET,https://raw.githubusercontent.com/anpplex/Surge/main/PlexProxy.list,🎞️ Plex代理
```

直连

```
RULE-SET,https://raw.githubusercontent.com/anpplex/Surge/main/PlexDirect.list,🎞️ Plex直连
```

## Emby

规则文件：https://raw.githubusercontent.com/anpplex/Surge/main/Emby.list

# 模块

## 签到

### 阿维塔

打开一次阿维塔 App，抓取 `loginToken`（约 24 小时）和 `refreshToken`（约 30 天）。登录凭证不足 6 小时或已经过期时，用 `getNewToken` 自动续期，再签到。每天 8:05–21:40 之间随机签一次，22:17 补签。脚本只读 `getNewToken`、`thirdLogin` 和 `getUserInfo`，读完把原来的正文原样放行。签到由定时任务自己请求，不拦截 App 里的签到页、首页、消息、IM 和控车。解密只有 `appserver-view.avatr.com`。`refreshToken` 过期后，再打开一次 App 重新登录。

脚本：https://raw.githubusercontent.com/anpplex/Surge/main/Script/avatr_surge.js

安装后打开 MitM，并允许通知。主机名只需要 `appserver-view.avatr.com`。

#### Surge

https://raw.githubusercontent.com/anpplex/Surge/main/sgmodule/avatr.sgmodule

#### Loon

https://raw.githubusercontent.com/anpplex/Surge/main/sgmodule/avatr.plugin

#### Shadowrocket

https://raw.githubusercontent.com/anpplex/Surge/main/sgmodule/avatr.shadowrocket.conf

用模块方式导入，不要当成完整配置覆盖。

#### Quantumult X

重写订阅：

https://raw.githubusercontent.com/anpplex/Surge/main/sgmodule/avatr.qxrewrite

把下面三行加到 `[task_local]`。前两行按时间签到，最后一行只在点任务时立即签到。

```
7,33,51 8-21 * * * https://raw.githubusercontent.com/anpplex/Surge/main/Script/avatr_surge.js, tag=阿维塔签到, enabled=true
17 22 * * * https://raw.githubusercontent.com/anpplex/Surge/main/Script/avatr_surge.js, tag=阿维塔补签, enabled=true
event-interaction https://raw.githubusercontent.com/anpplex/Surge/main/Script/avatr_now.js, tag=阿维塔立即签到, enabled=true
```

MitM 主机名：`appserver-view.avatr.com`

## 购物

### 京东比价

显示商品历史价格和最低价。

https://raw.githubusercontent.com/anpplex/Surge/main/sgmodule/jd.sgmodule

## 媒体

### 喜马拉雅

会员、大师课、音质音效和下载相关处理。

https://raw.githubusercontent.com/anpplex/Surge/main/sgmodule/xmly.sgmodule

## 效率

### Notability

解锁 Notability 高级订阅。

https://raw.githubusercontent.com/anpplex/Surge/main/sgmodule/NotabilityPlusUnlock.sgmodule

## 车辆

### 华为泊车距离

修改泊车合规检查返回值，解除泊车距离限制。

https://raw.githubusercontent.com/anpplex/Surge/main/sgmodule/Huawei-VPD-Unlock.sgmodule

https://raw.githubusercontent.com/anpplex/Surge/main/sgmodule/VPD-unlock.sgmodule
