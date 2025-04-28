using Sockets

function run_server(port::Int=8080)
    server = listen(port)
    println("Sphinx server running on port $port...")
    
    while true
        sock = accept(server)
        @async begin
            try
                line = readline(sock)
                if startswith(line, "GET /status")
                    response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nSphinx AI Agents Running"
                    write(sock, response)
                elseif startswith(line, "GET /start")
                    env = create_blockchain_env(2)
                    agents = [
                        create_voter_agent(1, true),
                        create_signer_agent(2)
                    ]
                    for step in 1:5
                        for agent in agents
                            step!(agent, env)
                        end
                        update_environment!(env, agents)
                    end
                    response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nAgents Started"
                    write(sock, response)
                else
                    response = "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\nNot Found"
                    write(sock, response)
                end
            catch e
                println("Server error: $e")
            finally
                close(sock)
            end
        end
    end
end
