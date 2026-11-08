#!/usr/bin/env bash
#
# 指纹计算共享逻辑
#
# 所有环境（CI、客户端、服务器）必须使用相同算法计算指纹

# 从清单文件计算指纹（排除 health.json 行）
# 参数：
#   $1 - 清单文件路径
# 返回：
#   8 字符指纹
calculate_fingerprint() {
    local manifest_file="$1"
    
    if [[ ! -f "$manifest_file" ]]; then
        echo "[ERROR] 清单文件不存在: $manifest_file" >&2
        return 1
    fi
    
    # 排除 health.json 的 SHA256 行，计算剩余内容的指纹
    # 格式: <64-hex-sha256><两个空格>health.json
    grep -v '^[0-9a-f]\{64\}  health\.json$' "$manifest_file" | sha256sum | cut -c1-8
}

# 生成版本名称
# 参数：
#   $1 - Git revision (完整 40 字符 SHA)
#   $2 - 清单文件路径
# 返回：
#   版本名称 (格式: <rev:0:8>-<fingerprint>)
generate_version_name() {
    local revision="$1"
    local manifest_file="$2"
    
    if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
        echo "[ERROR] REVISION 格式无效: $revision" >&2
        return 1
    fi
    
    local fingerprint
    fingerprint=$(calculate_fingerprint "$manifest_file")
    
    echo "${revision:0:8}-${fingerprint}"
}
