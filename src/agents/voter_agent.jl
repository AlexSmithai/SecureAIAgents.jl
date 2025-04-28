function create_voter_agent(id::Int, use_nn::Bool=false)
    AIAgent(id, "voter", random_voting_model, use_nn)
end
