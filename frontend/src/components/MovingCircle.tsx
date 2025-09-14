import React, { useState, useEffect, useRef } from "react";

interface MovingCircleProps {
    size: number;
    speed: number;
    color: string;
}

const MovingCircle: React.FC<MovingCircleProps> = ({ size, speed, color }) => {
    const [position, setPosition] = useState(0);
    const [windowWidth, setWindowWidth] = useState(window.innerWidth);
    const direction = useRef(1);
    const speedRef = useRef(speed);
    const sizeRef = useRef(size);
    const animationFrameRef = useRef<number | null>(null);

    useEffect(() => {
        speedRef.current = speed;
        sizeRef.current = size;
    }, [speed, size]);

    useEffect(() => {
        const handleResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        let lastTime: number | null = null;

        const animate = (time: number) => {
            if (lastTime !== null) {
                const delta = (time - lastTime) / 1000;
                setPosition((prev) => {
                    let next = prev + direction.current * speedRef.current * delta;

                    if (next < 0) {
                        next = 0;
                        direction.current = 1;
                    } else if (next > windowWidth - sizeRef.current) {
                        next = windowWidth - sizeRef.current;
                        direction.current = -1;
                    }

                    return next;
                });
            }
            lastTime = time;
            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animationFrameRef.current = requestAnimationFrame(animate);

        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [windowWidth]);

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100vw",
                height: "100vh",
                pointerEvents: "none",
            }}
        >
            <div
                style={{
                    width: `${size}px`,
                    height: `${size}px`,
                    borderRadius: "50%",
                    backgroundColor: color,
                    position: "absolute",
                    left: `${position}px`,
                    top: "50%",
                    transform: "translateY(-50%)",
                }}
            />
        </div>
    );
};

export default MovingCircle;
