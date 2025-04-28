function create_reader_agent(id::Int)
    AIAgent(id, "reader", random_voting_model)
end
