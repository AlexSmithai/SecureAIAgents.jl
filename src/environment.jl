function create_blockchain_env(num_agents::Int)
    env = Dict(
        "block_height" => 1,
        "transactions" => ["tx_$(i)" for i in 1:num_agents],
        "consensus" => Dict{Int, Any}()
    )
    return env
end

function update_environment!(env::Dict, agents::Vector{AIAgent})
    env["block_height"] += 1
    for agent in agents
        if agent.role == "voter" && haskey(agent.state, "vote")
            env["consensus"][agent.id] = agent.state["vote"]
        end
    end
    println("Environment updated. Block height: $(env["block_height"])")
end
