using SecureAIAgents

# Create agents: one with neural network, one with simple model
agents = [
    AIAgent(1, "voter", random_voting_model, true),  # Uses neural network
    AIAgent(2, "voter", block_height_voting_model)
]

env = create_blockchain_env(2)

for step in 1:10  # Run more steps to allow training
    println("Step $step:")
    for agent in agents
        step!(agent, env)
    end
    update_environment!(env, agents)
end
