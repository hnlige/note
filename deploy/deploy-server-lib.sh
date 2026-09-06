#!/bin/bash

capture_command_output() {
    local output_variable_name="$1"
    shift
    local captured_output

    if ! captured_output="$("$@")"; then
        return 1
    fi

    printf -v "$output_variable_name" '%s' "$captured_output"
}

resolve_host_runtime_env_file() {
    local server_dir="$1"
    local compiled_env_file="$server_dir/dist/.env"

    # PM2 从独立运行时目录启动，私有 .env 不进入代码仓库或构建收件目录。
    # 部署、健康检查和角色刷新必须复用这份配置，不能用构建产物中的 .env 覆盖线上数据库连接。
    local runtime_env_file="${RUNTIME_ENV_FILE:-/opt/duban/server/.env}"
    if [ -f "$runtime_env_file" ]; then
        printf '%s' "$runtime_env_file"
        return 0
    fi

    # 新主机尚未初始化运行时目录时，才回退使用构建产物携带的生产配置。
    if [ -f "$compiled_env_file" ]; then
        printf '%s' "$compiled_env_file"
        return 0
    fi

    return 1
}

select_public_runtime() {
    local expected_release_id="$1"
    local public_release_id="$2"
    local public_database_target_id="$3"
    local public_runtime_id="$4"
    local host_runtime_updated="$5"
    local host_database_target_id="$6"
    local host_runtime_id="$7"
    local container_runtime_updated="$8"
    local container_database_target_id="$9"
    local container_runtime_id="${10}"
    local host_matches=0
    local container_matches=0

    if [ -z "$expected_release_id" ] \
        || [ "$public_release_id" != "$expected_release_id" ] \
        || [ -z "$public_database_target_id" ] \
        || [ -z "$public_runtime_id" ]; then
        return 1
    fi

    if [ "$host_runtime_updated" = "1" ] \
        && [ -n "$host_database_target_id" ] \
        && [ -n "$host_runtime_id" ] \
        && [ "$public_database_target_id" = "$host_database_target_id" ] \
        && [ "$public_runtime_id" = "$host_runtime_id" ]; then
        host_matches=1
    fi

    if [ "$container_runtime_updated" = "1" ] \
        && [ -n "$container_database_target_id" ] \
        && [ -n "$container_runtime_id" ] \
        && [ "$public_database_target_id" = "$container_database_target_id" ] \
        && [ "$public_runtime_id" = "$container_runtime_id" ]; then
        container_matches=1
    fi

    if [ "$host_matches" -eq 1 ] && [ "$container_matches" -eq 0 ]; then
        printf '%s' 'host'
        return 0
    fi

    if [ "$host_matches" -eq 0 ] && [ "$container_matches" -eq 1 ]; then
        printf '%s' 'container'
        return 0
    fi

    return 1
}
