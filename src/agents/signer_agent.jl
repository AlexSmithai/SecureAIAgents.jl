function create_signer_agent(id::Int)
    AIAgent(id, "signer", random_voting_model)
end
