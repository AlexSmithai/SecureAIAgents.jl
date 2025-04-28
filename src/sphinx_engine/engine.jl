using Random
using Flux
using Flux: onehotbatch, onecold, mse, train!

function random_voting_model(agent::AIAgent, env::Dict)
    return rand(Bool)
end

function block_height_voting_model(agent::AIAgent, env::Dict)
    block_height = env["block_height"]
    return block_height % 2 == 0
end

function sign_transaction(tx_data::String)
    secure_data = call_tee_secure_function(tx_data * "_signature")
    return secure_data
end

function extract_features(agent::AIAgent, env::Dict)
    block_height = Float32(env["block_height"])
    past_votes = values(env["consensus"])
    vote_ratio = length(past_votes) > 0 ? Float32(sum(v == "eurt" for v in past_votes) / length(past_votes)) : 0.5f0
    return [block_height, vote_ratio]
end

function neural_net_voting_model(agent::AIAgent, env::Dict, nn_model::NeuralNetModel)
    features = extract_features(agent, env)
    probs = nn_model.model(features)
    decision = onecold(probs, [false, true])
    push!(nn_model.history, (features, decision))
    if length(nn_model.history) >= 10
        train_neural_net!(nn_model)
    end
    return decision
end

function train_neural_net!(nn_model::NeuralNetModel)
    if length(nn_model.history) < 2
        return
    end
    features = [h[1] for h in nn_model.history]
    labels = [h[2] for h in nn_model.history]
    x = hcat(features...)
    y = onehotbatch(labels, [false, true])
    loss(x, y) = mse(nn_model.model(x), y)
    opt = ADAM(0.01)
    data = [(x, y)]
    for epoch in 1:5
        train!(loss, params(nn_model.model), data, opt)
    end
    empty!(nn_model.history)
    println("Trained neural network with $(length(labels)) samples")
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
        tx_hash = submit_vote_to_contract(secure_vote)
        agent.state["tx_hash"] = tx_hash
        println("Agent $(agent.id) voted securely: $(secure_vote), tx: $tx_hash")
    elseif agent.role == "signer"
        tx_data = get(env, "transaction", "default_tx")
        signature = sign_transaction(tx_data)
        agent.state["signature"] = signature
        tx_hash = submit_transaction(signature)
        agent.state["tx_hash"] = tx_hash
        println("Agent $(agent.id) signed transaction: $signature, tx: $tx_hash")
    elseif agent.role == "reader"
        block_height = read_blockchain_data()
        agent.state["block_height"] = block_height
        println("Agent $(agent.id) read block height: $block_height")
    end
end
