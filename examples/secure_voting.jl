using Sphinx

agents = [
    create_voter_agent(1, true),
    create_voter_agent(2)
]

env = create_blockchain_env(2)

for step in 1:10
    println("Step $step:")
    for agent in agents
        step!(agent, env)
    end
    update_environment!(env, agents)
end
