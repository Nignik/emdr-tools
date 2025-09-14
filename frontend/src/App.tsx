import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Host from "./pages/Host";
import Client from "./pages/Client";

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/host" element={<Host />} />
                <Route path="/client" element={<Client />} />
            </Routes>
        </Router>
    );
}

export default App;
