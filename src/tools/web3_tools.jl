function call_smart_contract(method::String, params::Vector)
    try
        payload = Dict(
            "jsonrpc" => "2.0",
            "method" => "eth_call",
            "params" => [Dict(
                "to" => "0xYourContractAddress",
                "data" => "0x$(method)_$(join(params, "_"))"
            ), "latest"],
            "id" => 1
        )
        headers = Dict("Content-Type" => "application/json")
        response = HTTP.post(WEB3_PROVIDER_URL, headers, JSON.json(payload))
        result = JSON.parse(String(response.body))
        if haskey(result, "result")
            return result["result"]
        else
            error("Failed to call smart contract: $(result["error"]["message"])")
        end
    catch e
        println("Error calling smart contract: $e")
        return "0x0"
    end
end
