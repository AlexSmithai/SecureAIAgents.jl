mutable struct AIAgent
    id::Int
    role::String
    state::Dict
    decision_model::Function
    nn_model::Union{NeuralNetModel, Nothing}

    function AIAgent(id::Int, role::String, decision_model::Function, use_nn::Bool=false)
        state = Dict("key" => "", "vote" => nothing)
        nn_model = use_nn ? NeuralNetModel() : nothing
        new(id, role, state, decision_model, nn_model)
    end
end

function step!(agent::AIAgent, env::Dict)
    decision = if !isnothing(agent.nn_model) && agent.role == "voter"
        neural_net_voting_model(agent, env, agent.nn_model)
    else
        agent.decision_model(agent, env)
    end
    
    if agent.role == "voter"
        secure_vote = call_tee_secure_function(string(decision))
        agent.state["vote"] = secure_vote
        println("Agent $(agent.id) voted securely: $(secure_vote)")
    elseif agent.role == "signer"
        tx_data = get(env, "transaction", "default_tx")
        signature = sign_transaction(tx_data)
        agent.state["signature"] = signature
        println("Agent $(agent.id) signed transaction: $signature")
    end
end
