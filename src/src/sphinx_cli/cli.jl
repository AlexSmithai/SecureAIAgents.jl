function run_cli(args::Vector{String})
    if length(args) < 1
        println("Usage: julia --project run.jl <command>")
        println("Commands: start, stop, status")
        return
    end

    command = args[1]
    if command == "start"
        println("Starting Sphinx AI agents...")
        env = create_blockchain_env(2)
        agents = [
            create_voter_agent(1, true),
            create_signer_agent(2)
        ]
        for step in 1:5
            println("Step $step:")
            for agent in agents
                step!(agent, env)
            end
            update_environment!(env, agents)
        end
    elseif command == "stop"
        println("Stopping Sphinx AI agents...")
    elseif command == "status"
        println("Checking Sphinx AI agent status...")
    else
        println("Unknown command: $command")
    end
end

if abspath(PROGRAM_FILE) == @__FILE__
    run_cli(ARGS)
end
