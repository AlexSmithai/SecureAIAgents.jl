using Test
using SecureAIAgents

@testset "SecureAIAgents Tests" begin
    # Test agent creation
    agent = AIAgent(1, "voter", random_voting_model, true)
    @test agent.id == 1
    @test agent.role == "voter"
    @test !isnothing(agent.nn_model)
    
    # Test environment
    env = create_blockchain_env(1)
    @test env["block_height"] == 1
    
    # Test agent step with neural network
    step!(agent, env)
    @test haskey(agent.state, "vote")
    
    # Test TEE integration
    result = call_tee_secure_function("test")
    @test result == "tset"  # Reversed string from tee_secure.c
end
